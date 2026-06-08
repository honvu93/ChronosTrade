"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";
import {
    TradingErrorEnvelope,
    TradingExternalActionDeliveryListEnvelope,
    TradingExternalActionDeliveryView,
    TradingExternalActionEventListEnvelope,
    TradingExternalActionEventView,
    TradingExternalActionReplayEnvelope,
    TradingExternalActionReplayJobView,
    TradingExternalDeploymentEnvelope,
    TradingExternalDeploymentInput,
    TradingExternalDeploymentListEnvelope,
    TradingExternalDeploymentView,
} from "@/types/trading";

type HookStatus = "idle" | "loading" | "ready" | "error";

function requireAuthToken() {
    const token = readTradingAuthToken();
    if (!token) {
        throw new Error("A signed-in session is required before external signal actions can load.");
    }

    return token;
}

async function parseEnvelope<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => null) as T | TradingErrorEnvelope | null;
    if (!response.ok || !payload || (payload as TradingErrorEnvelope).success === false) {
        throw new Error(
            payload && (payload as TradingErrorEnvelope).success === false
                ? (payload as TradingErrorEnvelope).error.message
                : "External action request failed.",
        );
    }

    return payload as T;
}

function buildQuery(ownerUserId?: string | null, extra?: Record<string, string | null | undefined>) {
    const params = new URLSearchParams();
    if (ownerUserId) {
        params.set("userId", ownerUserId);
    }

    Object.entries(extra ?? {}).forEach(([key, value]) => {
        if (typeof value === "string" && value.trim()) {
            params.set(key, value.trim());
        }
    });

    const query = params.toString();
    return query ? `?${query}` : "";
}

export interface UseTradingExternalActionsResult {
    status: HookStatus;
    deployments: TradingExternalDeploymentView[];
    events: TradingExternalActionEventView[];
    deliveries: TradingExternalActionDeliveryView[];
    error: string | null;
    refreshing: boolean;
    mutating: boolean;
    refresh: () => Promise<void>;
    createDeployment: (input: TradingExternalDeploymentInput) => Promise<TradingExternalDeploymentView>;
    enableDeployment: (deploymentId: string) => Promise<TradingExternalDeploymentView>;
    pauseDeployment: (deploymentId: string, reason?: string | null) => Promise<TradingExternalDeploymentView>;
    archiveDeployment: (deploymentId: string, reason?: string | null) => Promise<TradingExternalDeploymentView>;
    replayEvent: (eventId: string) => Promise<TradingExternalActionReplayJobView>;
}

export function useTradingExternalActions({
    enabled = true,
    ownerUserId = null,
}: {
    enabled?: boolean;
    ownerUserId?: string | null;
} = {}): UseTradingExternalActionsResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [deployments, setDeployments] = useState<TradingExternalDeploymentView[]>([]);
    const [events, setEvents] = useState<TradingExternalActionEventView[]>([]);
    const [deliveries, setDeliveries] = useState<TradingExternalActionDeliveryView[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [mutating, setMutating] = useState(false);
    const activeRef = useRef(true);

    const load = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
        if (!enabled) {
            if (activeRef.current) {
                setDeployments([]);
                setEvents([]);
                setDeliveries([]);
                setError(null);
                setStatus("idle");
            }
            return;
        }

        if (background) {
            setRefreshing(true);
        } else {
            setStatus("loading");
        }
        setError(null);

        try {
            const headers = buildTradingAuthHeaders(requireAuthToken());
            const query = buildQuery(ownerUserId);

            const [deploymentsResponse, eventsResponse, deliveriesResponse] = await Promise.all([
                fetch(`/api/trading/external-actions/deployments${query}`, {
                    cache: "no-store",
                    headers,
                }),
                fetch(`/api/trading/external-actions/events${query}`, {
                    cache: "no-store",
                    headers,
                }),
                fetch(`/api/trading/external-actions/deliveries${query}`, {
                    cache: "no-store",
                    headers,
                }),
            ]);

            const [deploymentsEnvelope, eventsEnvelope, deliveriesEnvelope] = await Promise.all([
                parseEnvelope<TradingExternalDeploymentListEnvelope>(deploymentsResponse),
                parseEnvelope<TradingExternalActionEventListEnvelope>(eventsResponse),
                parseEnvelope<TradingExternalActionDeliveryListEnvelope>(deliveriesResponse),
            ]);

            if (!activeRef.current) {
                return;
            }

            setDeployments(deploymentsEnvelope.data.deployments);
            setEvents(eventsEnvelope.data.events);
            setDeliveries(deliveriesEnvelope.data.deliveries);
            setStatus("ready");
        } catch (loadError) {
            if (!activeRef.current) {
                return;
            }
            setError(loadError instanceof Error ? loadError.message : "Failed to load external signal actions.");
            setStatus("error");
        } finally {
            if (activeRef.current) {
                setRefreshing(false);
            }
        }
    }, [enabled, ownerUserId]);

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

    const createDeployment = useCallback(async (input: TradingExternalDeploymentInput) => {
        setMutating(true);
        setError(null);

        try {
            const response = await fetch(`/api/trading/external-actions/deployments${buildQuery(ownerUserId)}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...buildTradingAuthHeaders(requireAuthToken()),
                },
                body: JSON.stringify(input),
            });
            const envelope = await parseEnvelope<TradingExternalDeploymentEnvelope>(response);
            if (activeRef.current) {
                await load({ background: true });
            }
            return envelope.data;
        } catch (mutationError) {
            if (activeRef.current) {
                setError(mutationError instanceof Error ? mutationError.message : "Failed to create the external deployment.");
            }
            throw mutationError;
        } finally {
            if (activeRef.current) {
                setMutating(false);
            }
        }
    }, [load, ownerUserId]);

    const enableDeployment = useCallback(async (deploymentId: string) => {
        setMutating(true);
        setError(null);

        try {
            const response = await fetch(
                `/api/trading/external-actions/deployments/${encodeURIComponent(deploymentId)}/enable${buildQuery(ownerUserId)}`,
                {
                    method: "POST",
                    headers: buildTradingAuthHeaders(requireAuthToken()),
                },
            );
            const envelope = await parseEnvelope<TradingExternalDeploymentEnvelope>(response);
            if (activeRef.current) {
                await load({ background: true });
            }
            return envelope.data;
        } catch (mutationError) {
            if (activeRef.current) {
                setError(mutationError instanceof Error ? mutationError.message : "Failed to enable the external deployment.");
            }
            throw mutationError;
        } finally {
            if (activeRef.current) {
                setMutating(false);
            }
        }
    }, [load, ownerUserId]);

    const pauseDeployment = useCallback(async (deploymentId: string, reason?: string | null) => {
        setMutating(true);
        setError(null);

        try {
            const response = await fetch(
                `/api/trading/external-actions/deployments/${encodeURIComponent(deploymentId)}/pause${buildQuery(ownerUserId)}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...buildTradingAuthHeaders(requireAuthToken()),
                    },
                    body: JSON.stringify({ reason: reason ?? null }),
                },
            );
            const envelope = await parseEnvelope<TradingExternalDeploymentEnvelope>(response);
            if (activeRef.current) {
                await load({ background: true });
            }
            return envelope.data;
        } catch (mutationError) {
            if (activeRef.current) {
                setError(mutationError instanceof Error ? mutationError.message : "Failed to pause the external deployment.");
            }
            throw mutationError;
        } finally {
            if (activeRef.current) {
                setMutating(false);
            }
        }
    }, [load, ownerUserId]);

    const archiveDeployment = useCallback(async (deploymentId: string, reason?: string | null) => {
        setMutating(true);
        setError(null);

        try {
            const response = await fetch(
                `/api/trading/external-actions/deployments/${encodeURIComponent(deploymentId)}/archive${buildQuery(ownerUserId)}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...buildTradingAuthHeaders(requireAuthToken()),
                    },
                    body: JSON.stringify({ reason: reason ?? null }),
                },
            );
            const envelope = await parseEnvelope<TradingExternalDeploymentEnvelope>(response);
            if (activeRef.current) {
                await load({ background: true });
            }
            return envelope.data;
        } catch (mutationError) {
            if (activeRef.current) {
                setError(mutationError instanceof Error ? mutationError.message : "Failed to archive the external deployment.");
            }
            throw mutationError;
        } finally {
            if (activeRef.current) {
                setMutating(false);
            }
        }
    }, [load, ownerUserId]);

    const replayEvent = useCallback(async (eventId: string) => {
        setMutating(true);
        setError(null);

        try {
            const response = await fetch(
                `/api/trading/external-actions/events/${encodeURIComponent(eventId)}/replay${buildQuery(ownerUserId)}`,
                {
                    method: "POST",
                    headers: buildTradingAuthHeaders(requireAuthToken()),
                },
            );
            const envelope = await parseEnvelope<TradingExternalActionReplayEnvelope>(response);
            if (activeRef.current) {
                await load({ background: true });
            }
            return envelope.data;
        } catch (mutationError) {
            if (activeRef.current) {
                setError(mutationError instanceof Error ? mutationError.message : "Failed to queue the external signal replay.");
            }
            throw mutationError;
        } finally {
            if (activeRef.current) {
                setMutating(false);
            }
        }
    }, [load, ownerUserId]);

    return {
        status,
        deployments,
        events,
        deliveries,
        error,
        refreshing,
        mutating,
        refresh,
        createDeployment,
        enableDeployment,
        pauseDeployment,
        archiveDeployment,
        replayEvent,
    };
}
