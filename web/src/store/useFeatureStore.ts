"use client";

import { create } from "zustand";
import { TradingFeatureFlagSnapshot } from "@/types/trading";

export type FeatureStoreStatus = "idle" | "loading" | "ready" | "error";

interface FeatureStoreState {
    status: FeatureStoreStatus;
    snapshot: TradingFeatureFlagSnapshot | null;
    error: string | null;
    setLoading: () => void;
    setSnapshot: (snapshot: TradingFeatureFlagSnapshot) => void;
    setError: (message: string) => void;
}

export const useFeatureStore = create<FeatureStoreState>((set) => ({
    status: "idle",
    snapshot: null,
    error: null,
    setLoading: () => set((state) => ({
        status: "loading",
        snapshot: state.snapshot,
        error: null,
    })),
    setSnapshot: (snapshot) => set({
        status: "ready",
        snapshot,
        error: null,
    }),
    setError: (message) => set((state) => ({
        status: "error",
        snapshot: state.snapshot,
        error: message,
    })),
}));
