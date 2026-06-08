"use client";

import { AlertCircle, AlertTriangle } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useDataFreshness } from "@/store/useDataFreshness";
import { getFreshnessLabel } from "@/lib/freshnessUtils";
import type { DataFreshnessState } from "@/lib/freshnessUtils";

interface DataFreshnessBarProps {
  /** Override freshness state (e.g. for SSR-based unit tests). Falls back to store. */
  freshnessOverride?: DataFreshnessState;
}

export default function DataFreshnessBar({
  freshnessOverride,
}: DataFreshnessBarProps) {
  const { isAdmin } = useAuthSession();
  const { freshnessState } = useDataFreshness();
  const state = freshnessOverride ?? freshnessState;

  if (state === "gap" && !isAdmin) return null;

  // Only render a warning surface for stale or gap states
  if (state !== "stale" && state !== "gap") return null;

  const { label, description } = getFreshnessLabel(state);

  const isGap = state === "gap";
  const bannerClass = isGap
    ? "border-semantic-error/40 bg-semantic-error/8 text-semantic-error"
    : "border-semantic-warning/40 bg-semantic-warning/8 text-semantic-warning";
  const Icon = isGap ? AlertCircle : AlertTriangle;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex items-center gap-2 border-b px-4 py-2 text-xs ${bannerClass}`}
    >
      <Icon size={13} className="flex-shrink-0" aria-hidden="true" />
      <span className="font-bold">{label}:</span>
      <span>{description}</span>
    </div>
  );
}
