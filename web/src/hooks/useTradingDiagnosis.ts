"use client";

import { useCallback, useRef, useState } from "react";
import {
    TradingDiagnosisEnvelope,
    TradingDiagnosisRequestParams,
    TradingDiagnosisSnapshot,
    TradingErrorEnvelope,
    TradingInvestigationOutcome,
    TradingRootCauseCategory,
} from "@/types/trading";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";
import { buildTradingDiagnosisEndpoint } from "@/lib/tradingDiagnosisRequest";

type HookStatus = "idle" | "loading" | "ready" | "error";
type SaveStatus = "idle" | "saving" | "success" | "error";

export interface UseTradingDiagnosisResult {
    status: HookStatus;
    snapshot: TradingDiagnosisSnapshot | null;
    error: string | null;
    saveStatus: SaveStatus;
    saveError: string | null;
    load: (params: TradingDiagnosisRequestParams) => Promise<void>;
    recordOutcome: (input: {
        rootCauseCategory: TradingRootCauseCategory;
        outcome: TradingInvestigationOutcome;
        summary?: string | null;
    }) => Promise<void>;
    clear: () => void;
}

export function useTradingDiagnosis(): UseTradingDiagnosisResult {
    const [status, setStatus] = useState<HookStatus>("idle");
    const [snapshot, setSnapshot] = useState<TradingDiagnosisSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
    const [saveError, setSaveError] = useState<string | null>(null);
    const requestIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const lastParamsRef = useRef<TradingDiagnosisRequestParams | null>(null);

    const load = useCallback(async (params: TradingDiagnosisRequestParams) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        lastParamsRef.current = params;

        setStatus("loading");
        setError(null);
        setSaveStatus("idle");
        setSaveError(null);

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("A signed-in session is required before root-cause diagnosis can be reviewed.");
            }

            const response = await fetch(buildTradingDiagnosisEndpoint(params), {
                cache: "no-store",
                headers: buildTradingAuthHeaders(authToken),
                signal: controller.signal,
            });

            const payload = await response.json().catch(() => null) as
                | TradingDiagnosisEnvelope
                | TradingErrorEnvelope
                | null;

            if (!response.ok || !payload || payload.success === false) {
                throw new Error(
                    payload && payload.success === false
                        ? payload.error.message
                        : "Failed to load root-cause diagnosis.",
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
                    : "Failed to load root-cause diagnosis.",
            );
            setStatus("error");
        }
    }, []);

    const recordOutcome = useCallback(async ({
        rootCauseCategory,
        outcome,
        summary,
    }: {
        rootCauseCategory: TradingRootCauseCategory;
        outcome: TradingInvestigationOutcome;
        summary?: string | null;
    }) => {
        const params = lastParamsRef.current;
        if (!params) {
            throw new Error("Investigation context must be loaded before recording an outcome.");
        }

        setSaveStatus("saving");
        setSaveError(null);

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("A signed-in session is required before recording an investigation outcome.");
            }

            const response = await fetch(buildTradingDiagnosisEndpoint(params), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...buildTradingAuthHeaders(authToken),
                },
                body: JSON.stringify({
                    backtestRunId: params.backtestRunId ?? null,
                    indicatorInstanceId: params.indicatorInstanceId ?? null,
                    tradeRecordId: params.tradeRecordId ?? null,
                    rootCauseCategory,
                    outcome,
                    summary: summary ?? null,
                }),
            });

            const payload = await response.json().catch(() => null) as
                | { success: true; data: TradingDiagnosisSnapshot["history"][number] }
                | TradingErrorEnvelope
                | null;

            if (!response.ok || !payload || payload.success === false) {
                throw new Error(
                    payload && payload.success === false
                        ? payload.error.message
                        : "Failed to record the investigation outcome.",
                );
            }

            setSnapshot((current) => {
                if (!current) {
                    return current;
                }

                const nextHistory = [
                    payload.data,
                    ...current.history.filter((item) => item.id !== payload.data.id),
                ].slice(0, 6);

                return {
                    ...current,
                    latestOutcome: payload.data,
                    history: nextHistory,
                };
            });
            setSaveStatus("success");
        } catch (requestError) {
            setSaveError(
                requestError instanceof Error
                    ? requestError.message
                    : "Failed to record the investigation outcome.",
            );
            setSaveStatus("error");
        }
    }, []);

    const clear = useCallback(() => {
        abortRef.current?.abort();
        lastParamsRef.current = null;
        setSnapshot(null);
        setError(null);
        setStatus("idle");
        setSaveStatus("idle");
        setSaveError(null);
    }, []);

    return {
        status,
        snapshot,
        error,
        saveStatus,
        saveError,
        load,
        recordOutcome,
        clear,
    };
}
