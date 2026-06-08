"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";
import { buildScopedTradingWorkspaceAccountPath } from "@/lib/tradingWorkspaceAccountPaths";
import {
    buildTradingWorkspaceHistoryRequest,
    resolveTradingWorkspaceHistoryReset,
    type TradingWorkspaceHistoryQuery,
} from "@/lib/tradingWorkspaceHistory";
import {
    TradingAutomationBindingEnvelope,
    TradingAutomationBindingInput,
    TradingAutomationBindingStatusInput,
    TradingAutomationSnapshot,
    TradingAutomationSnapshotEnvelope,
    TradingCollectionEnvelope,
    TradingErrorEnvelope,
    TradingExecutionCommandEnvelope,
    TradingExecutionCommandInput,
    TradingExecutionCommandListEnvelope,
    TradingExecutionCommandView,
    TradingTradeIntentListEnvelope,
    TradingTradeIntentView,
    TradingWorkspaceDeal,
    TradingWorkspaceEnvelope,
    TradingWorkspaceSnapshot,
} from "@/types/trading";

type HookStatus = "idle" | "loading" | "ready" | "error";

function requireAuthToken() {
    const token = readTradingAuthToken();
    if (!token) {
        throw new Error("A signed-in session is required before the trading workspace can load.");
    }

    return token;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => null) as T | TradingErrorEnvelope | null;
    if (!response.ok || !payload || (payload as TradingErrorEnvelope).success === false) {
        throw new Error(
            payload && (payload as TradingErrorEnvelope).success === false
                ? (payload as TradingErrorEnvelope).error.message
                : "Trading workspace request failed.",
        );
    }

    return payload as T;
}

export interface UseTradingWorkspaceAccountResult {
    status: HookStatus;
    workspace: TradingWorkspaceSnapshot | null;
    commands: TradingExecutionCommandView[];
    automation: TradingAutomationSnapshot | null;
    intents: TradingTradeIntentView[];
    historyDeals: TradingWorkspaceDeal[];
    historyError: string | null;
    historyLoading: boolean;
    error: string | null;
    refreshing: boolean;
    syncing: boolean;
    mutating: boolean;
    refresh: () => Promise<void>;
    forceSync: () => Promise<void>;
    loadHistory: (query: TradingWorkspaceHistoryQuery) => Promise<void>;
    resetHistory: (options?: { clear?: boolean }) => void;
    submitCommand: (input: TradingExecutionCommandInput) => Promise<TradingExecutionCommandView>;
    createBinding: (input: TradingAutomationBindingInput) => Promise<void>;
    updateBinding: (bindingId: string, input: TradingAutomationBindingStatusInput) => Promise<void>;
}

export function useTradingWorkspaceAccount(
    {
        accountId,
        ownerUserId = null,
        enabled = true,
    }: {
        accountId: string | null;
        ownerUserId?: string | null;
        enabled?: boolean;
    },
): UseTradingWorkspaceAccountResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [workspace, setWorkspace] = useState<TradingWorkspaceSnapshot | null>(null);
    const [commands, setCommands] = useState<TradingExecutionCommandView[]>([]);
    const [automation, setAutomation] = useState<TradingAutomationSnapshot | null>(null);
    const [intents, setIntents] = useState<TradingTradeIntentView[]>([]);
    const [historyDeals, setHistoryDeals] = useState<TradingWorkspaceDeal[]>([]);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [mutating, setMutating] = useState(false);
    const activeRef = useRef(true);
    const historyQueryRef = useRef<TradingWorkspaceHistoryQuery | null>(null);

    const fetchHistoryDeals = useCallback(async (
        nextAccountId: string,
        query: TradingWorkspaceHistoryQuery,
        nextOwnerUserId?: string | null,
        headers?: HeadersInit,
    ) => {
        const params = new URLSearchParams();
        if (query.limit) {
            params.set("limit", String(query.limit));
        }
        if (query.from) {
            params.set("from", query.from);
        }
        if (query.to) {
            params.set("to", query.to);
        }

        const mergedParams = new URLSearchParams();
        if (nextOwnerUserId) {
            mergedParams.set("userId", nextOwnerUserId);
        }
        params.forEach((value, key) => mergedParams.set(key, value));

        const response = await fetch(
            `${buildScopedTradingWorkspaceAccountPath(nextAccountId, "/deals")}${mergedParams.size > 0 ? `?${mergedParams.toString()}` : ""}`,
            {
                cache: "no-store",
                headers: headers ?? buildTradingAuthHeaders(requireAuthToken()),
            },
        );
        const envelope = await parseEnvelope<TradingCollectionEnvelope<TradingWorkspaceDeal>>(response);
        return envelope.data.items;
    }, []);

    const load = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
        if (!enabled || !accountId) {
            if (activeRef.current) {
                setWorkspace(null);
                setCommands([]);
                setAutomation(null);
                setIntents([]);
                setHistoryDeals([]);
                setHistoryError(null);
                setHistoryLoading(false);
                setStatus("idle");
                setError(null);
            }
            return;
        }

        if (background) {
            setRefreshing(true);
        } else {
            setWorkspace(null);
            setCommands([]);
            setAutomation(null);
            setIntents([]);
            setHistoryDeals([]);
            setHistoryError(null);
            setStatus("loading");
        }
        setError(null);

        try {
            const token = requireAuthToken();
            const headers = buildTradingAuthHeaders(token);
            const [workspaceResponse, commandsResponse, automationResponse, intentsResponse] = await Promise.all([
                fetch(buildScopedTradingWorkspaceAccountPath(accountId, "/workspace", ownerUserId), { cache: "no-store", headers }),
                fetch(buildScopedTradingWorkspaceAccountPath(accountId, "/commands", ownerUserId), { cache: "no-store", headers }),
                fetch(buildScopedTradingWorkspaceAccountPath(accountId, "/automation/bindings", ownerUserId), { cache: "no-store", headers }),
                fetch(buildScopedTradingWorkspaceAccountPath(accountId, "/automation/intents", ownerUserId), { cache: "no-store", headers }),
            ]);

            const [workspaceEnvelope, commandsEnvelope, automationEnvelope, intentsEnvelope] = await Promise.all([
                parseEnvelope<TradingWorkspaceEnvelope>(workspaceResponse),
                parseEnvelope<TradingExecutionCommandListEnvelope>(commandsResponse),
                parseEnvelope<TradingAutomationSnapshotEnvelope>(automationResponse),
                parseEnvelope<TradingTradeIntentListEnvelope>(intentsResponse),
            ]);

            if (!activeRef.current) {
                return;
            }

            setWorkspace(workspaceEnvelope.data);
            setCommands(commandsEnvelope.data.items);
            setAutomation(automationEnvelope.data);
            setIntents(intentsEnvelope.data.items);
            setStatus("ready");

            const activeHistoryQuery = buildTradingWorkspaceHistoryRequest(historyQueryRef.current ?? {});
            if (activeHistoryQuery) {
                setHistoryLoading(true);
                setHistoryError(null);
                try {
                    const deals = await fetchHistoryDeals(accountId, activeHistoryQuery, ownerUserId, headers);
                    if (!activeRef.current) {
                        return;
                    }
                    setHistoryDeals(deals);
                } catch (historyLoadError) {
                    if (!activeRef.current) {
                        return;
                    }
                    setHistoryDeals([]);
                    setHistoryError(historyLoadError instanceof Error ? historyLoadError.message : "Failed to load filtered deal history.");
                } finally {
                    if (activeRef.current) {
                        setHistoryLoading(false);
                    }
                }
            } else {
                setHistoryDeals(workspaceEnvelope.data.deals);
                setHistoryError(null);
                setHistoryLoading(false);
            }
        } catch (loadError) {
            if (!activeRef.current) {
                return;
            }
            setError(loadError instanceof Error ? loadError.message : "Trading workspace request failed.");
            setStatus("error");
        } finally {
            if (activeRef.current) {
                setRefreshing(false);
            }
        }
    }, [accountId, enabled, fetchHistoryDeals, ownerUserId]);

    useEffect(() => {
        activeRef.current = true;
        void load();
        return () => {
            activeRef.current = false;
        };
    }, [load]);

    const refresh = useCallback(async () => {
        await load({ background: true });
    }, [load]);

    const loadHistory = useCallback(async (query: TradingWorkspaceHistoryQuery) => {
        if (!enabled || !accountId) {
            throw new Error("An account must be selected before history can be filtered.");
        }

        const normalizedQuery = buildTradingWorkspaceHistoryRequest(query);
        historyQueryRef.current = normalizedQuery;
        if (!normalizedQuery) {
            setHistoryDeals(resolveTradingWorkspaceHistoryReset(workspace?.deals));
            setHistoryError(null);
            setHistoryLoading(false);
            return;
        }

        setHistoryLoading(true);
        setHistoryError(null);

        try {
            const deals = await fetchHistoryDeals(accountId, normalizedQuery, ownerUserId);
            if (!activeRef.current) {
                return;
            }
            setHistoryDeals(deals);
        } catch (historyLoadError) {
            if (!activeRef.current) {
                return;
            }
            setHistoryDeals([]);
            setHistoryError(historyLoadError instanceof Error ? historyLoadError.message : "Failed to load filtered deal history.");
            throw historyLoadError;
        } finally {
            if (activeRef.current) {
                setHistoryLoading(false);
            }
        }
    }, [accountId, enabled, fetchHistoryDeals, ownerUserId, workspace?.deals]);

    const resetHistory = useCallback((options?: { clear?: boolean }) => {
        historyQueryRef.current = null;
        setHistoryDeals(resolveTradingWorkspaceHistoryReset(workspace?.deals, options));
        setHistoryError(null);
        setHistoryLoading(false);
    }, [workspace?.deals]);

    const forceSync = useCallback(async () => {
        if (!enabled || !accountId) {
            return;
        }

        setSyncing(true);
        setError(null);

        try {
            const response = await fetch(buildScopedTradingWorkspaceAccountPath(accountId, "/sync", ownerUserId), {
                method: "POST",
                headers: buildTradingAuthHeaders(requireAuthToken()),
            });
            const envelope = await parseEnvelope<TradingWorkspaceEnvelope>(response);
            if (!activeRef.current) {
                return;
            }
            setWorkspace(envelope.data);
            await load({ background: true });
        } catch (syncError) {
            if (activeRef.current) {
                setError(syncError instanceof Error ? syncError.message : "Failed to force sync the trading mirror.");
            }
            throw syncError;
        } finally {
            if (activeRef.current) {
                setSyncing(false);
            }
        }
    }, [accountId, enabled, load, ownerUserId]);

    const submitCommand = useCallback(async (input: TradingExecutionCommandInput) => {
        if (!enabled || !accountId) {
            throw new Error("An account must be selected before trading commands can be submitted.");
        }

        setMutating(true);
        setError(null);

        try {
            const response = await fetch(buildScopedTradingWorkspaceAccountPath(accountId, "/commands", ownerUserId), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...buildTradingAuthHeaders(requireAuthToken()),
                },
                body: JSON.stringify(input),
            });
            const envelope = await parseEnvelope<TradingExecutionCommandEnvelope>(response);
            if (activeRef.current) {
                await load({ background: true });
            }
            return envelope.data;
        } catch (submitError) {
            if (activeRef.current) {
                setError(submitError instanceof Error ? submitError.message : "Failed to submit the trading command.");
            }
            throw submitError;
        } finally {
            if (activeRef.current) {
                setMutating(false);
            }
        }
    }, [accountId, enabled, load, ownerUserId]);

    const createBinding = useCallback(async (input: TradingAutomationBindingInput) => {
        if (!enabled || !accountId) {
            throw new Error("An account must be selected before automation bindings can be created.");
        }

        setMutating(true);
        setError(null);

        try {
            const response = await fetch(buildScopedTradingWorkspaceAccountPath(accountId, "/automation/bindings", ownerUserId), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...buildTradingAuthHeaders(requireAuthToken()),
                },
                body: JSON.stringify(input),
            });
            await parseEnvelope<TradingAutomationBindingEnvelope>(response);
            if (activeRef.current) {
                await load({ background: true });
            }
        } catch (createError) {
            if (activeRef.current) {
                setError(createError instanceof Error ? createError.message : "Failed to create the automation binding.");
            }
            throw createError;
        } finally {
            if (activeRef.current) {
                setMutating(false);
            }
        }
    }, [accountId, enabled, load, ownerUserId]);

    const updateBinding = useCallback(async (bindingId: string, input: TradingAutomationBindingStatusInput) => {
        if (!enabled || !accountId) {
            throw new Error("An account must be selected before automation bindings can be updated.");
        }

        setMutating(true);
        setError(null);

        try {
            const response = await fetch(
                buildScopedTradingWorkspaceAccountPath(accountId, `/automation/bindings/${encodeURIComponent(bindingId)}`, ownerUserId),
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        ...buildTradingAuthHeaders(requireAuthToken()),
                    },
                    body: JSON.stringify(input),
                },
            );
            await parseEnvelope<TradingAutomationBindingEnvelope>(response);
            if (activeRef.current) {
                await load({ background: true });
            }
        } catch (updateError) {
            if (activeRef.current) {
                setError(updateError instanceof Error ? updateError.message : "Failed to update the automation binding.");
            }
            throw updateError;
        } finally {
            if (activeRef.current) {
                setMutating(false);
            }
        }
    }, [accountId, enabled, load, ownerUserId]);

    return {
        status,
        workspace,
        commands,
        automation,
        intents,
        historyDeals,
        historyError,
        historyLoading,
        error,
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
    };
}
