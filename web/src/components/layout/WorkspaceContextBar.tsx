"use client";

import { Activity, Layers, PanelTop } from "lucide-react";
import { useAppLocale } from "@/hooks/useAppLocale";
import { useMarketStore } from "@/store/useMarketStore";
import {
  getChartWorkspaceContext,
  type WorkspaceContextState,
} from "./workspaceContext";
import TimeframeSwitcher from "./TimeframeSwitcher";
import { useIndicatorOverlays } from "@/hooks/useIndicatorOverlays";

interface WorkspaceContextBarProps {
  landingLabel?: string;
  stateOverride?: WorkspaceContextState;
}

export default function WorkspaceContextBar({
  landingLabel = "Default Landing",
  stateOverride,
}: WorkspaceContextBarProps) {
  const { symbol, timeframe } = useMarketStore();
  const { locale, copy } = useAppLocale();
  const context = getChartWorkspaceContext(
    stateOverride ?? { symbol, timeframe },
    locale,
  );
  const { togglePanel, visibility } = useIndicatorOverlays();
  const activeOverlayCount = Object.values(visibility).filter(Boolean).length;

  return (
    <div className="border-b border-border-muted bg-bg-secondary/88 backdrop-blur-md">
      <div className="flex min-h-14 flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
            <PanelTop className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black tracking-wide text-text-primary">
                {context.workspaceLabel}
              </span>
                <span className="rounded-full border border-border-muted bg-bg-tertiary px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
                  {landingLabel}
                </span>
            </div>
            <p className="truncate text-xs text-text-secondary">
              {context.contextLabel}
            </p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 text-xs md:w-auto md:justify-end">
          <div className="flex items-center gap-2 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5">
            <Activity className="h-3.5 w-3.5 text-accent" />
            <span className="font-mono font-bold text-text-primary">
              {context.symbol}
            </span>
          </div>
          <TimeframeSwitcher timeframeOverride={stateOverride?.timeframe} />
          <button
            type="button"
            onClick={togglePanel}
            aria-label={copy.workspace.indicatorOverlays}
            className="relative flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-3 py-1.5 text-xs transition-colors hover:border-accent/40 hover:bg-accent/5"
          >
            <Layers className="h-3.5 w-3.5 text-text-muted" />
            <span className="font-mono font-bold text-text-secondary">
              {copy.workspace.indicatorOverlays}
            </span>
            {activeOverlayCount > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/20 text-[10px] font-black text-accent">
                {activeOverlayCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
