"use client";

import { create } from "zustand";
import { type DataFreshnessState } from "@/lib/freshnessUtils";

interface DataFreshnessStoreState {
  freshnessState: DataFreshnessState;
  latestTimestamp: string | null;
  candleCount: number;
  setFreshness: (update: {
    state: DataFreshnessState;
    latestTimestamp: string | null;
    candleCount: number;
  }) => void;
  setError: () => void;
}

export const useDataFreshness = create<DataFreshnessStoreState>((set) => ({
  freshnessState: "loading",
  latestTimestamp: null,
  candleCount: 0,
  setFreshness: ({ state, latestTimestamp, candleCount }) =>
    set({ freshnessState: state, latestTimestamp, candleCount }),
  setError: () => set({ freshnessState: "error" }),
}));
