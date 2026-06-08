"use client";

import { useEffect } from "react";
import { useFeatureStore } from "@/store/useFeatureStore";
import {
    TradingErrorEnvelope,
    TradingFeatureFlagEnvelope,
    TradingFeatureFlagSnapshot,
} from "@/types/trading";
import { buildTradingAuthHeaders, readTradingAuthToken } from "@/lib/tradingApiAuth";

const readEnvelope = async (response: Response): Promise<TradingFeatureFlagSnapshot> => {
    const payload = await response.json().catch(() => null) as TradingFeatureFlagEnvelope | TradingErrorEnvelope | null;

    if (!response.ok || !payload || payload.success === false) {
        throw new Error(
            payload && payload.success === false
                ? payload.error.message
                : "Failed to load runtime trading flags",
        );
    }

    return payload.data;
};

export function useTradingFeatureFlags({
    enabled = true,
    accountId = null,
    ownerUserId = null,
}: {
    enabled?: boolean;
    accountId?: string | null;
    ownerUserId?: string | null;
} = {}) {
    const status = useFeatureStore((state) => state.status);
    const snapshot = useFeatureStore((state) => state.snapshot);
    const error = useFeatureStore((state) => state.error);
    const setLoading = useFeatureStore((state) => state.setLoading);
    const setSnapshot = useFeatureStore((state) => state.setSnapshot);
    const setError = useFeatureStore((state) => state.setError);

    useEffect(() => {
        if (!enabled) {
            return;
        }

        let active = true;

        const load = async () => {
            setLoading();

            try {
                const authToken = readTradingAuthToken();
                if (!authToken) {
                    throw new Error("Trading access requires a signed-in session before runtime flags can load.");
                }

                const params = new URLSearchParams();
                if (accountId) {
                    params.set("accountId", accountId);
                }
                if (ownerUserId) {
                    params.set("userId", ownerUserId);
                }
                const response = await fetch(`/api/trading/operations/access${params.size > 0 ? `?${params.toString()}` : ""}`, {
                    cache: "no-store",
                    headers: buildTradingAuthHeaders(authToken),
                });
                const nextSnapshot = await readEnvelope(response);
                if (!active) {
                    return;
                }
                setSnapshot(nextSnapshot);
            } catch (loadError) {
                if (!active) {
                    return;
                }
                setError(loadError instanceof Error ? loadError.message : "Failed to load runtime trading flags");
            }
        };

        void load();

        return () => {
            active = false;
        };
    }, [accountId, enabled, ownerUserId, setError, setLoading, setSnapshot]);

    const refresh = async () => {
        if (!enabled) {
            return;
        }

        setLoading();

        try {
            const authToken = readTradingAuthToken();
            if (!authToken) {
                throw new Error("Trading access requires a signed-in session before runtime flags can load.");
            }

            const params = new URLSearchParams();
            if (accountId) {
                params.set("accountId", accountId);
            }
            if (ownerUserId) {
                params.set("userId", ownerUserId);
            }
            const response = await fetch(`/api/trading/operations/access${params.size > 0 ? `?${params.toString()}` : ""}`, {
                cache: "no-store",
                headers: buildTradingAuthHeaders(authToken),
            });
            setSnapshot(await readEnvelope(response));
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load runtime trading flags");
        }
    };

    return {
        status,
        snapshot,
        error,
        refresh,
    };
}
