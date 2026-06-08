"use client";

import { create } from "zustand";

export type OverlayId =
  | "rsi"
  | "rsi_ema9"
  | "rsi_wma45"
  | "sma20"
  | "sma50"
  | "sma200";

export interface OverlayDefinition {
  id: OverlayId;
  label: string;
  group: "momentum" | "trend";
  defaultVisible: boolean;
}

export const OVERLAY_DEFINITIONS: readonly OverlayDefinition[] = [
  { id: "rsi",      label: "RSI (14)",    group: "momentum", defaultVisible: true },
  { id: "rsi_ema9", label: "RSI EMA (9)", group: "momentum", defaultVisible: true },
  { id: "rsi_wma45",label: "RSI WMA (45)",group: "momentum", defaultVisible: true },
  { id: "sma20",    label: "SMA (20)",    group: "trend",    defaultVisible: false },
  { id: "sma50",    label: "SMA (50)",    group: "trend",    defaultVisible: false },
  { id: "sma200",   label: "SMA (200)",   group: "trend",    defaultVisible: false },
];

interface IndicatorOverlaysState {
  visibility: Record<OverlayId, boolean>;
  isPanelOpen: boolean;
  toggleOverlay: (id: OverlayId) => void;
  togglePanel: () => void;
  closePanel: () => void;
}

export const useIndicatorOverlays = create<IndicatorOverlaysState>((set) => ({
  visibility: Object.fromEntries(
    OVERLAY_DEFINITIONS.map((o) => [o.id, o.defaultVisible]),
  ) as Record<OverlayId, boolean>,
  isPanelOpen: false,
  toggleOverlay: (id) =>
    set((state) => ({
      visibility: { ...state.visibility, [id]: !state.visibility[id] },
    })),
  togglePanel: () => set((state) => ({ isPanelOpen: !state.isPanelOpen })),
  closePanel: () => set({ isPanelOpen: false }),
}));
