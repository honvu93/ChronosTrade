"use client";

import { Eye, EyeOff, X, Settings } from "lucide-react";
import {
  useIndicatorOverlays,
  OVERLAY_DEFINITIONS,
} from "@/hooks/useIndicatorOverlays";
import { useRsiSettings } from "@/hooks/useRsiSettings";

const GROUP_LABELS: Record<string, string> = {
  momentum: "Momentum",
  trend: "Trend",
};

interface IndicatorOverlayPanelProps {
  /** Override panel open state (e.g. for SSR-based unit tests). Falls back to store value. */
  openOverride?: boolean;
}

export default function IndicatorOverlayPanel({ openOverride }: IndicatorOverlayPanelProps) {
  const { visibility, isPanelOpen, toggleOverlay, closePanel } =
    useIndicatorOverlays();
  const { openDialog } = useRsiSettings();

  const isOpen = openOverride ?? isPanelOpen;
  if (!isOpen) return null;

  const groups = ["momentum", "trend"] as const;

  return (
    <div
      role="dialog"
      aria-label="Indicator overlays"
      className="absolute top-2 right-4 z-30 w-52 rounded-xl border border-border-muted bg-bg-secondary/95 backdrop-blur-md shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-border-muted px-3 py-2.5">
        <span className="text-xs font-black uppercase tracking-wider text-text-primary">
          Indicators
        </span>
        <button
          type="button"
          onClick={closePanel}
          aria-label="Close indicator panel"
          className="text-text-muted transition-colors hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>

      {groups.map((group) => {
        const groupOverlays = OVERLAY_DEFINITIONS.filter(
          (o) => o.group === group,
        );
        return (
          <div key={group} className="px-2 py-1.5">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">
                {GROUP_LABELS[group]}
              </span>
              {group === "momentum" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openDialog();
                    closePanel();
                  }}
                  className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
                  aria-label="RSI Settings"
                >
                  <Settings size={11} />
                </button>
              )}
            </div>
            {groupOverlays.map((overlay) => {
              const visible = visibility[overlay.id];
              return (
                <button
                  key={overlay.id}
                  type="button"
                  onClick={() => toggleOverlay(overlay.id)}
                  aria-pressed={visible}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-tertiary"
                >
                  <span
                    className={`text-xs font-medium ${visible ? "text-text-primary" : "text-text-muted"
                      }`}
                  >
                    {overlay.label}
                  </span>
                  {visible ? (
                    <Eye size={13} className="flex-shrink-0 text-accent" />
                  ) : (
                    <EyeOff
                      size={13}
                      className="flex-shrink-0 text-text-muted"
                    />
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
