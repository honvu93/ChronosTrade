"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    SignalVersionEnvelope,
    SignalVersionRequestParams,
    SignalVersionSnapshot,
    TradingErrorEnvelope,
} from "@/types/trading";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";
import { buildSignalVersionEndpoint } from "@/lib/signalVersionRequest";

type HookStatus = "idle" | "loading" | "ready" | "error";

export interface UseSignalVersionContextResult {
    status: HookStatus;
    snapshot: SignalVersionSnapshot | null;
    error: string | null;
    load: (params: SignalVersionRequestParams) => Promise<void>;
}

export function useSignalVersionContext(): UseSignalVersionContextResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [snapshot, setSnapshot] = useState<SignalVersionSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const activeRef = useRef(true);
    const requestIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        activeRef.current = true;
        return () => {
            activeRef.current = false;
            abortRef.current?.abort();
        };
    }, []);

    const load = useCallback(async (params: SignalVersionRequestParams) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        setStatus("loading");
        setSnapshot(null);
        setError(null);

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("A signed-in session is required to inspect signal version context.");
            }

            const response = await fetch(buildSignalVersionEndpoint(params), {
                cache: "no-store",
                headers: buildTradingAuthHeaders(authToken),
                signal: controller.signal,
            });

            const payload = await response.json().catch(() => null) as
                | SignalVersionEnvelope
                | TradingErrorEnvelope
                | null;

            if (!response.ok || !payload || payload.success === false) {
                throw new Error(
                    payload && payload.success === false
                        ? payload.error.message
                        : "Failed to load signal version context.",
                );
            }

            if (!activeRef.current || controller.signal.aborted || requestId !== requestIdRef.current) {
                return;
            }

            setSnapshot(payload.data);
            setStatus("ready");
        } catch (err) {
            if (!activeRef.current || controller.signal.aborted || requestId !== requestIdRef.current) {
                return;
            }
            setError(err instanceof Error ? err.message : "Failed to load signal version context.");
            setStatus("error");
        }
    }, []);

    return { status, snapshot, error, load };
}
