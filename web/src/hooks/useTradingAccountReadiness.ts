"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    AccountReadinessEnvelope,
    AccountReadinessSnapshot,
    TradingErrorEnvelope,
} from "@/types/trading";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";

type HookStatus = "idle" | "loading" | "ready" | "error";

export interface UseTradingAccountReadinessResult {
    status: HookStatus;
    snapshot: AccountReadinessSnapshot | null;
    error: string | null;
    refresh: () => Promise<void>;
}

const ENDPOINT = "/api/trading/operations/account-readiness";

export function useTradingAccountReadiness(
    {
        enabled = true,
        refreshToken = 0,
        accountId = null,
    }: {
        enabled?: boolean;
        refreshToken?: number;
        accountId?: string | null;
    } = {},
): UseTradingAccountReadinessResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [snapshot, setSnapshot] = useState<AccountReadinessSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const activeRef = useRef(true);

    const load = useCallback(async () => {
        if (!enabled) return;

        setStatus("loading");
        setError(null);

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("A signed-in session is required before account readiness can be evaluated.");
            }

            const params = new URLSearchParams();
            if (accountId) {
                params.set("accountId", accountId);
            }

            const response = await fetch(params.size > 0 ? `${ENDPOINT}?${params.toString()}` : ENDPOINT, {
                cache: "no-store",
                headers: buildTradingAuthHeaders(authToken),
            });

            const payload = await response.json().catch(() => null) as
                | AccountReadinessEnvelope
                | TradingErrorEnvelope
                | null;

            if (!response.ok || !payload || payload.success === false) {
                throw new Error(
                    payload && payload.success === false
                        ? payload.error.message
                        : "Failed to load trading account readiness.",
                );
            }

            if (!activeRef.current) return;

            setSnapshot(payload.data);
            setStatus("ready");
        } catch (err) {
            if (!activeRef.current) return;
            setError(err instanceof Error ? err.message : "Failed to load trading account readiness.");
            setStatus("error");
        }
    }, [accountId, enabled]);

    useEffect(() => {
        activeRef.current = true;
        void load();
        return () => {
            activeRef.current = false;
        };
    }, [load, refreshToken]);

    const refresh = useCallback(async () => {
        await load();
    }, [load]);

    return { status, snapshot, error, refresh };
}
