"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    SignalEligibilityListEnvelope,
    SignalLiveEligibilityItem,
    TradingErrorEnvelope,
} from "@/types/trading";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";

type HookStatus = "idle" | "loading" | "ready" | "error";

export interface UseSignalLiveEligibilityResult {
    status: HookStatus;
    items: SignalLiveEligibilityItem[];
    error: string | null;
    refresh: () => Promise<void>;
}

const ENDPOINT = "/api/trading/operations/signal-eligibility";

export function useSignalLiveEligibility(
    { enabled = true }: { enabled?: boolean } = {},
): UseSignalLiveEligibilityResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [items, setItems] = useState<SignalLiveEligibilityItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const activeRef = useRef(true);

    const load = useCallback(async () => {
        if (!enabled) return;

        setStatus("loading");
        setError(null);

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("A signed-in session is required before signal eligibility can be evaluated.");
            }

            const response = await fetch(ENDPOINT, {
                cache: "no-store",
                headers: buildTradingAuthHeaders(authToken),
            });

            const payload = await response.json().catch(() => null) as
                | SignalEligibilityListEnvelope
                | TradingErrorEnvelope
                | null;

            if (!response.ok || !payload || payload.success === false) {
                throw new Error(
                    payload && payload.success === false
                        ? payload.error.message
                        : "Failed to load signal live eligibility.",
                );
            }

            if (!activeRef.current) return;

            setItems(payload.data.items);
            setStatus("ready");
        } catch (err) {
            if (!activeRef.current) return;
            setError(err instanceof Error ? err.message : "Failed to load signal live eligibility.");
            setStatus("error");
        }
    }, [enabled]);

    useEffect(() => {
        activeRef.current = true;
        void load();
        return () => {
            activeRef.current = false;
        };
    }, [load]);

    const refresh = useCallback(async () => {
        await load();
    }, [load]);

    return { status, items, error, refresh };
}
