"use client";

import { useCallback, useRef, useState } from "react";
import {
    TradingDiscrepancyEnvelope,
    TradingDiscrepancyRequestParams,
    TradingDiscrepancySnapshot,
    TradingErrorEnvelope,
} from "@/types/trading";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";
import { buildTradingDiscrepancyEndpoint } from "@/lib/tradingDiscrepancyRequest";

type HookStatus = "idle" | "loading" | "ready" | "error";

export interface UseTradingDiscrepancyResult {
    status: HookStatus;
    snapshot: TradingDiscrepancySnapshot | null;
    error: string | null;
    load: (params: TradingDiscrepancyRequestParams) => Promise<void>;
    clear: () => void;
}

export function useTradingDiscrepancy(): UseTradingDiscrepancyResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [snapshot, setSnapshot] = useState<TradingDiscrepancySnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const requestIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const load = useCallback(async (params: TradingDiscrepancyRequestParams) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        setStatus("loading");
        setError(null);
        setSnapshot(null);

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("A signed-in session is required before discrepancy context can be inspected.");
            }

            const response = await fetch(buildTradingDiscrepancyEndpoint(params), {
                cache: "no-store",
                headers: buildTradingAuthHeaders(authToken),
                signal: controller.signal,
            });

            const payload = await response.json().catch(() => null) as
                | TradingDiscrepancyEnvelope
                | TradingErrorEnvelope
                | null;

            if (!response.ok || !payload || payload.success === false) {
                throw new Error(
                    payload && payload.success === false
                        ? payload.error.message
                        : "Failed to load backtest-versus-live discrepancy context.",
                );
            }

            if (controller.signal.aborted || requestId !== requestIdRef.current) {
                return;
            }

            setSnapshot(payload.data);
            setStatus("ready");
        } catch (requestError) {
            if (controller.signal.aborted || requestId !== requestIdRef.current) {
                return;
            }

            setError(
                requestError instanceof Error
                    ? requestError.message
                    : "Failed to load backtest-versus-live discrepancy context.",
            );
            setStatus("error");
        }
    }, []);

    const clear = useCallback(() => {
        abortRef.current?.abort();
        setSnapshot(null);
        setError(null);
        setStatus("idle");
    }, []);

    return {
        status,
        snapshot,
        error,
        load,
        clear,
    };
}
