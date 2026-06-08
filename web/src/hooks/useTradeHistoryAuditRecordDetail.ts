"use client";

import { useCallback, useRef, useState } from "react";
import {
    TradeHistoryAuditDetailEnvelope,
    TradeHistoryAuditDetailSnapshot,
    TradingErrorEnvelope,
} from "@/types/trading";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";

type HookStatus = "idle" | "loading" | "ready" | "error";

const buildDetailEndpoint = (recordId: string) =>
    `/api/trading/operations/trade-history/${encodeURIComponent(recordId)}`;

export interface UseTradeHistoryAuditRecordDetailResult {
    status: HookStatus;
    detail: TradeHistoryAuditDetailSnapshot | null;
    error: string | null;
    activeRecordId: string | null;
    inspect: (recordId: string) => Promise<void>;
    clear: () => void;
}

export function useTradeHistoryAuditRecordDetail(): UseTradeHistoryAuditRecordDetailResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [detail, setDetail] = useState<TradeHistoryAuditDetailSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
    const requestIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const inspect = useCallback(async (recordId: string) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        setActiveRecordId(recordId);
        setDetail(null);
        setStatus("loading");
        setError(null);

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("A signed-in session is required before execution detail can be inspected.");
            }

            const response = await fetch(buildDetailEndpoint(recordId), {
                cache: "no-store",
                headers: buildTradingAuthHeaders(authToken),
                signal: controller.signal,
            });

            const payload = await response.json().catch(() => null) as
                | TradeHistoryAuditDetailEnvelope
                | TradingErrorEnvelope
                | null;

            if (!response.ok || !payload || payload.success === false) {
                throw new Error(
                    payload && payload.success === false
                        ? payload.error.message
                        : "Failed to load execution record detail.",
                );
            }

            if (controller.signal.aborted || requestId !== requestIdRef.current) {
                return;
            }

            setDetail(payload.data);
            setStatus("ready");
        } catch (requestError) {
            if (controller.signal.aborted || requestId !== requestIdRef.current) {
                return;
            }

            setError(
                requestError instanceof Error
                    ? requestError.message
                    : "Failed to load execution record detail.",
            );
            setStatus("error");
        }
    }, []);

    const clear = useCallback(() => {
        abortRef.current?.abort();
        setStatus("idle");
        setDetail(null);
        setError(null);
        setActiveRecordId(null);
    }, []);

    return {
        status,
        detail,
        error,
        activeRecordId,
        inspect,
        clear,
    };
}
