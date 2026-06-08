"use client";

import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  Loader,
} from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useDataFreshness } from "@/store/useDataFreshness";
import { getFreshnessLabel } from "@/lib/freshnessUtils";
import { useAppLocale } from "@/hooks/useAppLocale";
import type { DataFreshnessState } from "@/lib/freshnessUtils";

interface ChartStatusBarProps {
  candleCount: number;
  startTime: string;
  endTime: string;
  /** @deprecated freshness is now read from the useDataFreshness store */
  isSynced?: boolean;
  lastUpdated: string;
  /** Override freshness state (e.g. for SSR-based unit tests). Falls back to store. */
  freshnessOverride?: DataFreshnessState;
}

function FreshnessBadge({ state }: { state: DataFreshnessState }) {
  const { label } = getFreshnessLabel(state);

  switch (state) {
    case "fresh":
      return (
        <div className="flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5">
          <CheckCircle2 size={12} className="text-accent" aria-hidden="true" />
          <span className="font-mono font-bold uppercase tracking-tight text-accent">
            {label}
          </span>
        </div>
      );
    case "stale":
      return (
        <div className="flex items-center gap-1.5 rounded-full border border-semantic-warning/30 bg-semantic-warning/10 px-2 py-0.5">
          <AlertTriangle
            size={12}
            className="text-semantic-warning"
            aria-hidden="true"
          />
          <span className="font-mono font-bold uppercase tracking-tight text-semantic-warning">
            {label}
          </span>
        </div>
      );
    case "gap":
      return (
        <div className="flex items-center gap-1.5 rounded-full border border-semantic-error/30 bg-semantic-error/10 px-2 py-0.5">
          <AlertCircle
            size={12}
            className="text-semantic-error"
            aria-hidden="true"
          />
          <span className="font-mono font-bold uppercase tracking-tight text-semantic-error">
            {label}
          </span>
        </div>
      );
    case "error":
      return (
        <div className="flex items-center gap-1.5 rounded-full border border-semantic-error/30 bg-semantic-error/10 px-2 py-0.5">
          <AlertCircle
            size={12}
            className="text-semantic-error"
            aria-hidden="true"
          />
          <span className="font-mono font-bold uppercase tracking-tight text-semantic-error">
            {label}
          </span>
        </div>
      );
    case "loading":
    default:
      return (
        <div className="flex items-center gap-1.5 rounded-full border border-border-muted bg-bg-tertiary px-2 py-0.5">
          <Loader size={12} className="animate-spin text-text-muted" aria-hidden="true" />
          <span className="font-mono font-bold uppercase tracking-tight text-text-muted">
            {label}
          </span>
        </div>
      );
  }
}

export default function ChartStatusBar({
  candleCount,
  startTime,
  endTime,
  lastUpdated,
  freshnessOverride,
}: ChartStatusBarProps) {
  const { isAdmin } = useAuthSession();
  const { freshnessState } = useDataFreshness();
  const state = freshnessOverride ?? freshnessState;
  const showFreshnessBadge = isAdmin || state !== "gap";
  const { copy } = useAppLocale();

  return (
    <div className="flex h-8 w-full select-none items-center justify-between border-t border-border-muted bg-bg-secondary/80 px-4 text-[11px] text-text-muted backdrop-blur-md">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Database size={12} className="opacity-70 text-text-muted" />
          <span className="font-mono text-text-primary">
            {candleCount.toLocaleString()}
          </span>
          <span>{copy.chartStatus.candles}</span>
        </div>

        <div className="h-3 w-px bg-border-muted opacity-40" />

        <div className="flex items-center gap-1.5">
          <Calendar size={12} className="text-semantic-error opacity-70" />
          <span className="font-mono text-text-primary opacity-90">
            {startTime}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Clock size={12} className="text-accent opacity-70" />
          <span className="font-mono text-text-primary opacity-90">
            {endTime}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {showFreshnessBadge ? <FreshnessBadge state={state} /> : null}
        <div className="flex items-center gap-1">
          <span>{copy.chartStatus.lastUpdated}</span>
          <span className="font-mono text-text-primary">{lastUpdated}</span>
        </div>
      </div>
    </div>
  );
}
