"use client";

import { useFeatureStore } from "@/store/useFeatureStore";
import { TradingCapabilityTier, TradingFeatureFlagKey } from "@/types/trading";

const tierByKey: Record<TradingFeatureFlagKey, TradingCapabilityTier> = {
    trading_read_enabled: "read",
    trading_write_enabled: "write",
    trading_automation_enabled: "automation",
};

export function useFeatureFlag(key: TradingFeatureFlagKey): boolean {
    return useFeatureStore((state) => {
        const tier = tierByKey[key];
        return state.snapshot?.capabilities[tier].enabled ?? false;
    });
}
