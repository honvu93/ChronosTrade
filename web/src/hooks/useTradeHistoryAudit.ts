"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    TradeHistoryAuditDetailEnvelope,
    TradeHistoryAuditDetailSnapshot,
    TradeHistoryAuditEnvelope,
    TradeHistoryAuditSnapshot,
    TradingErrorEnvelope,
} from "@/types/trading";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";

type HookStatus = "idle" | "loading" | "ready" | "error";

const LIST_ENDPOINT = "/api/trading/operations/trade-history";
const buildDetailEndpoint = (recordId: string) =>
    `/api/trading/operations/trade-history/${encodeURIComponent(recordId)}`;

export interface UseTradeHistoryAuditResult {
    status: HookStatus;
    snapshot: TradeHistoryAuditSnapshot | null;
    error: string | null;
    refresh: () => Promise<void>;
    activeRecordId: string | null;
    detailStatus: HookStatus;
    detail: TradeHistoryAuditDetailSnapshot | null;
    detailError: string | null;
    inspect: (recordId: string) => Promise<void>;
    clearDetail: () => void;
}

export function useTradeHistoryAudit(
    { enabled = true }: { enabled?: boolean } = {},
): UseTradeHistoryAuditResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [snapshot, setSnapshot] = useState<TradeHistoryAuditSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
    const [detailStatus, setDetailStatus] = useState<HookStatus>("idle");
    const [detail, setDetail] = useState<TradeHistoryAuditDetailSnapshot | null>(null);
    const [detailError, setDetailError] = useState<string | null>(null);
    const activeRef = useRef(true);
    const listAbortRef = useRef<AbortController | null>(null);
    const detailAbortRef = useRef<AbortController | null>(null);
    const detailRequestIdRef = useRef(0);

    useEffect(() => {
        activeRef.current = true;
        return () => {
            activeRef.current = false;
            listAbortRef.current?.abort();
            detailAbortRef.current?.abort();
        };
    }, []);

    const loadList = useCallback(async () => {
        if (!enabled) return;

        listAbortRef.current?.abort();
        const controller = new AbortController();
        listAbortRef.current = controller;

        setStatus("loading");
        setError(null);

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("A signed-in session is required before trade history can be reviewed.");
            }

            const response = await fetch(LIST_ENDPOINT, {
                cache: "no-store",
                headers: buildTradingAuthHeaders(authToken),
                signal: controller.signal,
            });

            const payload = await response.json().catch(() => null) as
                | TradeHistoryAuditEnvelope
                | TradingErrorEnvelope
                | null;

            if (!response.ok || !payload || payload.success === false) {
                throw new Error(
                    payload && payload.success === false
                        ? payload.error.message
                        : "Failed to load trade history and audit timeline.",
                );
            }

            if (!activeRef.current || controller.signal.aborted) return;

            setSnapshot(payload.data);
            setStatus("ready");
        } catch (err) {
            if (!activeRef.current || controller.signal.aborted) return;
            setError(err instanceof Error ? err.message : "Failed to load trade history and audit timeline.");
            setStatus("error");
        }
    }, [enabled]);

    useEffect(() => {
        void loadList();
    }, [loadList]);

    const inspect = useCallback(async (recordId: string) => {
        if (!enabled) return;

        detailAbortRef.current?.abort();
        const controller = new AbortController();
        detailAbortRef.current = controller;
        const requestId = detailRequestIdRef.current + 1;
        detailRequestIdRef.current = requestId;

        setActiveRecordId(recordId);
        setDetailStatus("loading");
        setDetail(null);
        setDetailError(null);

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("A signed-in session is required before trade detail can be inspected.");
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
                        : "Failed to load trade history detail.",
                );
            }

            if (!activeRef.current || controller.signal.aborted || requestId !== detailRequestIdRef.current) {
                return;
            }

            setDetail(payload.data);
            setDetailStatus("ready");
        } catch (err) {
            if (!activeRef.current || controller.signal.aborted || requestId !== detailRequestIdRef.current) {
                return;
            }
            setDetailError(err instanceof Error ? err.message : "Failed to load trade history detail.");
            setDetailStatus("error");
        }
    }, [enabled]);

    const refresh = useCallback(async () => {
        await loadList();
    }, [loadList]);

    const clearDetail = useCallback(() => {
        detailAbortRef.current?.abort();
        setActiveRecordId(null);
        setDetail(null);
        setDetailError(null);
        setDetailStatus("idle");
    }, []);

    return {
        status,
        snapshot,
        error,
        refresh,
        activeRecordId,
        detailStatus,
        detail,
        detailError,
        inspect,
        clearDetail,
    };
}
