"use client";

import { useMarketStore } from "@/store/useMarketStore";
import { useAppLocale } from "@/hooks/useAppLocale";
import { AVAILABLE_TIMEFRAMES } from "./workspaceContext";

interface TimeframeSwitcherProps {
  /** Override the displayed active timeframe (e.g. from stateOverride in tests). Falls back to store value. */
  timeframeOverride?: string;
}

export default function TimeframeSwitcher({ timeframeOverride }: TimeframeSwitcherProps) {
  const { timeframe: storeTimeframe, setTimeframe } = useMarketStore();
  const { copy } = useAppLocale();
  const activeTimeframe = timeframeOverride ?? storeTimeframe;

  return (
    <div
      role="group"
      aria-label={copy.timeframeSwitcher.ariaLabel}
      className="flex max-w-full flex-wrap items-center gap-0.5 rounded-2xl border border-border-muted bg-bg-tertiary px-1.5 py-1"
    >
      {AVAILABLE_TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => setTimeframe(tf)}
          aria-pressed={activeTimeframe === tf}
          className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-bold transition-colors ${
            activeTimeframe === tf
              ? "bg-accent/15 text-accent"
              : "text-text-muted hover:bg-white/5 hover:text-text-secondary"
          }`}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
