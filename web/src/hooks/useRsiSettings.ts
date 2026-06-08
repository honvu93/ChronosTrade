"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LineStyle = "solid" | "dotted" | "dashed";

export interface RsiStyleSettings {
    rsi14: {
        visible: boolean;
        colors: [string, string, string]; // red, green, purple from reference
        lineStyle: LineStyle;
    };
    ema9: {
        visible: boolean;
        color: string;
        lineStyle: LineStyle;
    };
    wma45: {
        visible: boolean;
        color: string;
        lineStyle: LineStyle;
    };
    buySignal: {
        visible: boolean;
        color: string;
        shape: "triangle-up" | "circle" | "arrow-up";
        mode: "Absolute" | "Relative";
    };
    sellSignal: {
        visible: boolean;
        color: string;
        shape: "triangle-down" | "circle" | "arrow-down";
        mode: "Absolute" | "Relative";
    };
    overbought: {
        visible: boolean;
        color: string;
        lineStyle: LineStyle;
        value: number;
    };
    midline: {
        visible: boolean;
        color: string;
        lineStyle: LineStyle;
        value: number;
    };
    oversold: {
        visible: boolean;
        color: string;
        lineStyle: LineStyle;
        value: number;
    };
    precision: string;
}

interface RsiSettingsState {
    settings: RsiStyleSettings;
    isDialogOpen: boolean;
    updateSettings: (newSettings: Partial<RsiStyleSettings>) => void;
    openDialog: () => void;
    closeDialog: () => void;
    resetToDefaults: () => void;
}

const DEFAULT_SETTINGS: RsiStyleSettings = {
    rsi14: {
        visible: true,
        colors: ["#F6465D", "#26C870", "#B23AEE"],
        lineStyle: "solid",
    },
    ema9: {
        visible: true,
        color: "#F0B90B", // Orange/Yellow
        lineStyle: "solid",
    },
    wma45: {
        visible: true,
        color: "#26C870", // Green
        lineStyle: "solid",
    },
    buySignal: {
        visible: true,
        color: "#26C870",
        shape: "triangle-up",
        mode: "Absolute",
    },
    sellSignal: {
        visible: true,
        color: "#F6465D",
        shape: "triangle-down",
        mode: "Absolute",
    },
    overbought: {
        visible: true,
        color: "#FFFFFF",
        lineStyle: "dotted",
        value: 80,
    },
    midline: {
        visible: true,
        color: "#6B7280",
        lineStyle: "dashed",
        value: 50,
    },
    oversold: {
        visible: true,
        color: "#FFFFFF",
        lineStyle: "dotted",
        value: 20,
    },
    precision: "Default",
};

export const useRsiSettings = create<RsiSettingsState>()(
    persist(
        (set) => ({
            settings: DEFAULT_SETTINGS,
            isDialogOpen: false,
            updateSettings: (newSettings) =>
                set((state) => ({ settings: { ...state.settings, ...newSettings } })),
            openDialog: () => set({ isDialogOpen: true }),
            closeDialog: () => set({ isDialogOpen: false }),
            resetToDefaults: () => set({ settings: DEFAULT_SETTINGS }),
        }),
        {
            name: "rsi-indicator-settings",
        }
    )
);
