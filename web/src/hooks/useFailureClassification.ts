"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    FailureClassificationEnvelope,
    FailureClassificationSnapshot,
    TradingErrorEnvelope,
} from "@/types/trading";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";

type HookStatus = "idle" | "loading" | "ready" | "error";

export interface UseFailureClassificationResult {
    status: HookStatus;
    snapshot: FailureClassificationSnapshot | null;
    error: string | null;
    refresh: () => Promise<void>;
}

const ENDPOINT = "/api/trading/operations/failure-classification";

export function useFailureClassification(
    { enabled = true }: { enabled?: boolean } = {},
): UseFailureClassificationResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [snapshot, setSnapshot] = useState<FailureClassificationSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const activeRef = useRef(true);

    const load = useCallback(async () => {
        if (!enabled) return;

        setStatus("loading");
        setError(null);

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("A signed-in session is required before failure classification can be evaluated.");
            }

            const response = await fetch(ENDPOINT, {
                cache: "no-store",
                headers: buildTradingAuthHeaders(authToken),
            });

            const payload = await response.json().catch(() => null) as
                | FailureClassificationEnvelope
                | TradingErrorEnvelope
                | null;

            if (!response.ok || !payload || payload.success === false) {
                throw new Error(
                    payload && payload.success === false
                        ? payload.error.message
                        : "Failed to load failure classification.",
                );
            }

            if (!activeRef.current) return;

            setSnapshot(payload.data);
            setStatus("ready");
        } catch (err) {
            if (!activeRef.current) return;
            setError(err instanceof Error ? err.message : "Failed to load failure classification.");
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

    return { status, snapshot, error, refresh };
}
